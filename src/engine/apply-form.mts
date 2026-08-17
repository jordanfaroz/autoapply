import type { Locator } from "playwright";

import type { ScreeningQuestion } from "./adapters/types.mts";
import { SelectorError } from "./adapters/types.mts";

/**
 * Generic, site-agnostic interaction with an apply form/modal: extracting its
 * questions, filling in resolved answers, and finding the button that actually
 * submits it. Nothing here knows about any particular site's class names — only
 * HTML semantics (input types, label associations) — so every adapter can reuse it.
 *
 * This is the part of the apply flow built without ever having seen a real,
 * authenticated modal (see the step-7 build notes). It is deliberately
 * conservative: anything it cannot confidently read — an unlabeled field, a
 * checkbox (whose meaning varies too much to automate blind), an ambiguous submit
 * button — makes it throw `SelectorError` rather than guess. That turns an
 * unanticipated layout into a screenshot and a paused job, never a bad fill.
 */

const MARKER_ATTR = "data-aa-field";
const OPTION_ATTR = "data-aa-option";

/** Extracts every fillable field inside `container`, stamping each with a marker. */
export async function extractFormFields(container: Locator): Promise<ScreeningQuestion[]> {
  const result = await container.evaluate((root, { markerAttr, optionAttr }) => {
    function labelFor(el: Element): string {
      const aria = el.getAttribute("aria-label");
      if (aria?.trim()) return aria.trim();

      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const ref = document.getElementById(labelledBy);
        if (ref?.textContent?.trim()) return ref.textContent.trim();
      }

      const id = el.getAttribute("id");
      if (id) {
        const forLabel = root.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (forLabel?.textContent?.trim()) return forLabel.textContent.trim();
      }

      const wrapping = el.closest("label");
      if (wrapping) {
        const clone = wrapping.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("input,select,textarea").forEach((n) => n.remove());
        const text = clone.textContent?.trim();
        if (text) return text;
      }

      // Fall back to the nearest ancestor's own direct text (not text belonging to a
      // deeper descendant, which risks picking up an unrelated field's label).
      let node: Element | null = el.parentElement;
      for (let hops = 0; node && hops < 4; hops++, node = node.parentElement) {
        for (const child of node.childNodes) {
          if (child.nodeType === 3 && (child.textContent ?? "").trim().length > 2) {
            return (child.textContent ?? "").trim();
          }
        }
      }
      return "";
    }

    const visible = (el: HTMLElement) => el.offsetParent !== null && !el.hidden;

    type Out = {
      id: string;
      label: string;
      type: "text" | "textarea" | "number" | "choice";
      options?: string[];
      maxLength?: number | null;
    };
    const out: Out[] = [];
    let counter = 0;
    const nextId = () => `f${counter++}`;

    for (const el of root.querySelectorAll("textarea")) {
      if (!visible(el as HTMLElement) || (el as HTMLTextAreaElement).disabled) continue;
      const id = nextId();
      el.setAttribute(markerAttr, id);
      out.push({
        id,
        label: labelFor(el),
        type: "textarea",
        maxLength: (el as HTMLTextAreaElement).maxLength > 0
          ? (el as HTMLTextAreaElement).maxLength
          : null,
      });
    }

    for (const el of root.querySelectorAll("select")) {
      const select = el as HTMLSelectElement;
      if (!visible(select) || select.disabled) continue;
      const id = nextId();
      select.setAttribute(markerAttr, id);
      const options = [...select.options]
        .map((o) => o.textContent?.trim() ?? "")
        .filter((t) => t && !/^(select|choose)\b/i.test(t) && t !== "--");
      out.push({ id, label: labelFor(select), type: "choice", options });
    }

    for (const el of root.querySelectorAll(
      'input[type="text"], input[type="tel"], input[type="email"], input:not([type])',
    )) {
      const input = el as HTMLInputElement;
      if (!visible(input) || input.disabled) continue;
      const id = nextId();
      input.setAttribute(markerAttr, id);
      out.push({
        id,
        label: labelFor(input),
        type: "text",
        maxLength: input.maxLength > 0 ? input.maxLength : null,
      });
    }

    for (const el of root.querySelectorAll('input[type="number"]')) {
      const input = el as HTMLInputElement;
      if (!visible(input) || input.disabled) continue;
      const id = nextId();
      input.setAttribute(markerAttr, id);
      out.push({ id, label: labelFor(input), type: "number" });
    }

    const radios = [...root.querySelectorAll('input[type="radio"]')]
      .filter((el) => visible(el as HTMLElement)) as HTMLInputElement[];
    const groups = new Map<string, HTMLInputElement[]>();
    for (const el of radios) {
      const key = el.name || "__unnamed__";
      const group = groups.get(key) ?? [];
      group.push(el);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const id = nextId();
      let groupLabel = "";
      const fieldset = group[0].closest("fieldset");
      const legend = fieldset?.querySelector("legend");
      if (legend?.textContent?.trim()) groupLabel = legend.textContent.trim();

      const options: string[] = [];
      for (const el of group) {
        const optionLabel = labelFor(el) || el.value;
        el.setAttribute(markerAttr, id);
        el.setAttribute(optionAttr, optionLabel);
        options.push(optionLabel);
      }
      if (!groupLabel) {
        // Best effort: the nearest ancestor's own direct text, same technique as
        // labelFor's fallback, applied to the group's shared container.
        let node: Element | null = group[0].parentElement;
        for (let hops = 0; node && hops < 5 && !groupLabel; hops++, node = node.parentElement) {
          for (const child of node.childNodes) {
            const text = (child.textContent ?? "").trim();
            if (child.nodeType === 3 && text.length > 2 && !options.includes(text)) {
              groupLabel = text;
              break;
            }
          }
        }
      }
      out.push({ id, label: groupLabel, type: "choice", options });
    }

    const hasCheckbox = root.querySelector('input[type="checkbox"]') !== null;
    const unlabeled = out.filter((f) => f.label.trim().length < 3);

    return { fields: out, hasCheckbox, unlabeledCount: unlabeled.length };
  }, { markerAttr: MARKER_ATTR, optionAttr: OPTION_ATTR });

  if (result.hasCheckbox) {
    throw new SelectorError(
      "a form with only text/select/radio fields (checkboxes are not supported yet)",
      'input[type="checkbox"]',
    );
  }
  if (result.unlabeledCount > 0) {
    throw new SelectorError(
      `a visible label for every form field (${result.unlabeledCount} field(s) had none)`,
      "[aria-label], label",
    );
  }

  return result.fields.map((f) => ({
    fieldId: f.id,
    questionText: f.label,
    fieldType: f.type,
    ...(f.options ? { options: f.options } : {}),
  }));
}

/** Fills one previously-extracted field with its resolved answer. Never submits anything. */
export async function fillField(
  container: Locator,
  field: ScreeningQuestion,
  answer: string,
): Promise<void> {
  if (field.fieldType === "choice" && field.options) {
    const select = container.locator(`select[${MARKER_ATTR}="${field.fieldId}"]`);
    if (await select.count()) {
      await select.selectOption({ label: answer });
      return;
    }

    const radio = container.locator(
      `input[type="radio"][${MARKER_ATTR}="${field.fieldId}"][${OPTION_ATTR}="${cssAttrEscape(answer)}"]`,
    );
    if (await radio.count()) {
      await radio.check();
      return;
    }

    throw new SelectorError(
      `the "${answer}" option for "${field.questionText}"`,
      `[${OPTION_ATTR}]`,
    );
  }

  const locator = container.locator(`[${MARKER_ATTR}="${field.fieldId}"]`);
  if (!(await locator.count())) {
    throw new SelectorError(`the field for "${field.questionText}"`, `[${MARKER_ATTR}]`);
  }
  await locator.fill(answer);
}

/** CSS attribute-value escaping for the small set of characters that matter here. */
function cssAttrEscape(value: string): string {
  return value.replace(/"/g, '\\"');
}

const SUBMIT_PATTERN = /\b(submit|apply now|send application|send|confirm|yes,? apply)\b/i;
const CANCEL_PATTERN = /\b(cancel|close|back|no,? thanks|not now)\b/i;

/**
 * Finds the one button that actually submits the form. Ambiguity is treated as
 * failure — picking the wrong one of two plausible buttons is exactly the mistake
 * this whole module exists to avoid.
 */
export async function findSubmitButton(container: Locator): Promise<Locator> {
  const buttons = container.locator('button, [role="button"], input[type="submit"]');
  const count = await buttons.count();

  const candidates: Locator[] = [];
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    const text = ((await button.textContent()) ?? "").trim();
    const value = (await button.getAttribute("value")) ?? "";
    const label = `${text} ${value}`.trim();
    if (CANCEL_PATTERN.test(label)) continue;
    if (SUBMIT_PATTERN.test(label)) candidates.push(button);
  }

  if (candidates.length === 1) return candidates[0];
  throw new SelectorError(
    candidates.length === 0
      ? "a submit button (Submit / Apply Now / Send / Confirm)"
      : `exactly one submit button (found ${candidates.length} ambiguous candidates)`,
    "button",
  );
}

/** Best-effort close: never throws, since failing to close is not unsafe. */
export async function closeDialog(container: Locator): Promise<void> {
  try {
    const closeButton = container.getByRole("button", { name: /close/i }).first();
    if (await closeButton.count()) {
      await closeButton.click({ timeout: 3_000 });
      return;
    }
    await container.page().keyboard.press("Escape");
  } catch {
    // The next job's navigation abandons this page regardless.
  }
}

const SUCCESS_PATTERN =
  /application (sent|submitted)|applied successfully|successfully applied|your application (has been|was) (sent|submitted|received)/i;

/** Broad, text-based check that a real submission actually went through. */
export async function verifySubmitSuccess(container: Locator): Promise<boolean> {
  const page = container.page();
  const text = await page
    .locator("body")
    .innerText({ timeout: 5_000 })
    .catch(() => "");
  return SUCCESS_PATTERN.test(text);
}
