// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { isTextField, isTyping } from './input';

function input(type: string): HTMLInputElement {
  const el = document.createElement('input');
  el.type = type;
  return el;
}

describe('isTextField', () => {
  it('counts inputs you type into', () => {
    for (const type of ['text', 'number', 'search', 'email', 'url', 'password', 'tel']) {
      expect(isTextField(input(type)), type).toBe(true);
    }
  });

  it('counts text areas, menus, and editable content', () => {
    expect(isTextField(document.createElement('textarea'))).toBe(true);
    expect(isTextField(document.createElement('select'))).toBe(true);
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    document.body.append(editable);
    expect(isTextField(editable)).toBe(true);
    editable.remove();
  });

  it('leaves out checkboxes, radios, buttons, and sliders', () => {
    for (const type of ['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file']) {
      expect(isTextField(input(type)), type).toBe(false);
    }
    expect(isTextField(document.createElement('button'))).toBe(false);
  });

  it('leaves out everything else', () => {
    expect(isTextField(document.createElement('div'))).toBe(false);
    expect(isTextField(document)).toBe(false);
    expect(isTextField(window)).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});

describe('isTyping', () => {
  it('is whether a key event is aimed at a text field', () => {
    const field = input('text');
    const box = input('checkbox');
    document.body.append(field, box);
    const typed = (target: EventTarget) => {
      let result: boolean | undefined;
      target.addEventListener('keydown', (e) => (result = isTyping(e)), { once: true });
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      return result;
    };
    expect(typed(field)).toBe(true);
    expect(typed(box)).toBe(false);
    field.remove();
    box.remove();
  });
});
