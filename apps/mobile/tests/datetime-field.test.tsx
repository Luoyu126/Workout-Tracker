import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, dependencies: undefined as unknown[] | undefined }));
const platform = vi.hoisted(() => ({ OS: "web" }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = value; }];
  },
  useEffect: (effect: () => void, deps: unknown[]) => {
    if (!hooks.dependencies || deps.some((value, index) => value !== hooks.dependencies?.[index])) effect();
    hooks.dependencies = deps;
  }
}));
vi.mock("react-native", () => ({
  View: "view", Text: "text", Pressable: "button", FlatList: "list", Modal: "modal",
  Platform: platform,
  StyleSheet: { create: (value: unknown) => value }
}));
vi.mock("@/lib/i18n/I18nProvider", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import { DateTimeField } from "../src/components/ui/DateTimeField";

type NodeProps = { children?: ReactNode; accessibilityLabel?: string; accessibilityViewIsModal?: boolean; tabIndex?: number; label?: string; onPress?: () => void; onSelect?: (value: number) => void; visible?: boolean; selected?: number };
function nodes(node: ReactNode): NodeProps[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<NodeProps>(node) || node.props.visible === false) return [];
  return [node.props, ...nodes(node.props.children)];
}
const onChange = vi.fn();
let value = "";
function render() {
  hooks.index = 0;
  return DateTimeField({ label: "Start", value, onChange });
}
function press(label: string) {
  const node = nodes(render()).find((props) => props.onPress && (props.accessibilityLabel === label || nodes(props.children).some((child) => child.children === label)));
  if (!node?.onPress) throw new Error(`Missing button ${label}`);
  node.onPress();
}
function select(label: string, value: number) {
  const node = nodes(render()).find((props) => props.label === label && props.onSelect);
  if (!node?.onSelect) throw new Error(`Missing options ${label}`);
  node.onSelect(value);
}

describe("date/time field interaction", () => {
  beforeEach(() => {
    hooks.states = []; hooks.index = 0; hooks.dependencies = undefined;
    value = ""; onChange.mockReset();
    platform.OS = "web";
  });

  test.each(["date", "time"])("web %s modal offers a stable focus target before virtualized options", (mode) => {
    value = "2026-09-07T12:00:00Z";
    press(`Start dateTime.${mode}`);
    const content = nodes(render());
    const sheetIndex = content.findIndex((props) => props.accessibilityViewIsModal);
    expect(sheetIndex).toBeGreaterThanOrEqual(0);
    expect(content[sheetIndex].tabIndex).toBe(-1);
    expect(sheetIndex).toBeLessThan(content.findIndex((props) => props.onSelect));
    expect(onChange).not.toHaveBeenCalled();
    press("common.cancel");
    press(`Start dateTime.${mode}`);
    expect(nodes(render()).find((props) => props.accessibilityViewIsModal)?.tabIndex).toBe(-1);
  });

  test("native modal keeps platform focus behavior", () => {
    platform.OS = "ios";
    press("Start dateTime.date");
    expect(nodes(render()).find((props) => props.accessibilityViewIsModal)?.tabIndex).toBeUndefined();
  });

  test("requires both date and time before emitting an instant", () => {
    press("Start dateTime.date");
    select("dateTime.year", 2028); select("dateTime.month", 2); select("dateTime.day", 29);
    press("dateTime.confirm");
    expect(onChange).not.toHaveBeenCalled();
    press("Start dateTime.time"); select("dateTime.time", 37); press("dateTime.confirm");
    expect(onChange).toHaveBeenLastCalledWith("2028-02-29T10:30:00.000Z");
  });

  test("cancel preserves a legacy 18:15 value, confirming a new time uses half-hours", () => {
    value = "2026-09-06T10:15:23.123Z";
    press("Start dateTime.time"); select("dateTime.time", 38); press("common.cancel");
    expect(onChange).not.toHaveBeenCalled();
    expect(nodes(render()).some((props) => props.children === "18:15:23.123")).toBe(true);
    press("Start dateTime.time"); select("dateTime.time", 37); press("dateTime.confirm");
    expect(onChange).toHaveBeenLastCalledWith("2026-09-06T10:30:00.000Z");
  });

  test("opening and confirming without choosing a new time preserves the original", () => {
    value = "2026-09-06T10:15:23.123Z";
    press("Start dateTime.time"); press("dateTime.confirm");
    expect(onChange).toHaveBeenLastCalledWith(value);
  });

  test("date changes retain exact legacy time and clamp invalid month days", () => {
    value = "2028-01-31T10:15:23.123Z";
    press("Start dateTime.date"); select("dateTime.month", 2); press("dateTime.confirm");
    expect(onChange).toHaveBeenLastCalledWith("2028-02-29T10:15:23.123Z");
  });

  test("can choose time before date and clear optional filters", () => {
    press("Start dateTime.time"); select("dateTime.time", 0); press("dateTime.confirm");
    expect(onChange).not.toHaveBeenCalled();
    press("Start dateTime.date"); select("dateTime.year", 2027); select("dateTime.month", 1); select("dateTime.day", 1);
    press("dateTime.confirm");
    expect(onChange).toHaveBeenLastCalledWith("2026-12-31T16:00:00.000Z");
    press("Start dateTime.clear");
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});
