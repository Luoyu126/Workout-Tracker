import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useRef: (current: unknown) => ({ current }),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => (() => void) | void) => { lifecycle.cleanup = effect() ?? undefined; }
}));
vi.mock("react-native", () => ({
  View: "view", Text: "text", Pressable: "button", FlatList: "list", Modal: "modal",
  StyleSheet: { create: (value: unknown) => value }
}));
vi.mock("@/lib/i18n/I18nProvider", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import { DateTimeOptions } from "../src/components/ui/DateTimeField";

type ListProps = {
  children?: ReactNode;
  ref: { current: { scrollToIndex: (options: { index: number; viewPosition: number; animated: boolean }) => void } | null };
  onLayout: (event: { nativeEvent: { layout: { height: number } } }) => void;
  onContentSizeChange: (width: number, height: number) => void;
};
function findList(node: ReactNode): ListProps | undefined {
  if (Array.isArray(node)) return node.map(findList).find(Boolean);
  if (!isValidElement<ListProps>(node)) return undefined;
  return node.type === "list" ? node.props : findList(node.props.children);
}
function mount(year: number) {
  const props = findList(DateTimeOptions({ label: "Year", values: Array.from({ length: 9999 }, (_, index) => index + 1), selected: year, onSelect: vi.fn() }));
  if (!props) throw new Error("Missing year list");
  const scrollToIndex = vi.fn();
  props.ref.current = { scrollToIndex };
  return { props, scrollToIndex };
}

describe("date picker selected year positioning", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
    vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  });
  afterEach(() => { lifecycle.cleanup?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  test.each(["content-first", "layout-first"])("centers 2026 after modal measurements: %s", (order) => {
    const { props, scrollToIndex } = mount(2026);
    const content = () => props.onContentSizeChange(100, 9999 * 44);
    const layout = () => props.onLayout({ nativeEvent: { layout: { height: 220 } } });
    (order === "content-first" ? content : layout)();
    vi.runAllTimers();
    expect(scrollToIndex).not.toHaveBeenCalled();
    (order === "content-first" ? layout : content)();
    vi.runAllTimers();
    expect(scrollToIndex).toHaveBeenCalledWith({ index: 2025, viewPosition: 0.5, animated: false });
    // Virtualized content updates after the user scrolls must not drag them back.
    content(); vi.runAllTimers();
    expect(scrollToIndex).toHaveBeenCalledTimes(1);
  });

  test("reopening uses the saved year and corrects changed viewport height", () => {
    const { props, scrollToIndex } = mount(2028);
    props.onContentSizeChange(100, 9999 * 44);
    props.onLayout({ nativeEvent: { layout: { height: 220 } } }); vi.runAllTimers();
    expect(scrollToIndex).toHaveBeenLastCalledWith({ index: 2027, viewPosition: 0.5, animated: false });
    props.onLayout({ nativeEvent: { layout: { height: 176 } } }); vi.runAllTimers();
    expect(scrollToIndex).toHaveBeenCalledTimes(2);
  });

  test("closing before layout settles cancels the pending positioning", () => {
    const { props, scrollToIndex } = mount(2026);
    props.onContentSizeChange(100, 9999 * 44);
    props.onLayout({ nativeEvent: { layout: { height: 220 } } });
    lifecycle.cleanup?.(); vi.runAllTimers();
    expect(scrollToIndex).not.toHaveBeenCalled();
  });
});
