import { Alert, Platform, type AlertButton } from "react-native";

// react-native-web ships Alert.alert as an empty method, so every confirmation
// dialog would silently do nothing in a browser. Bridge it to the native
// browser dialogs instead, keeping call sites plain React Native.
function pickConfirmButton(buttons: readonly AlertButton[]) {
  const confirmButtons = buttons.filter((button) => button.style !== "cancel");
  return confirmButtons[confirmButtons.length - 1];
}

function alertOnWeb(title: string, message?: string, buttons?: readonly AlertButton[]) {
  const prompt = [title, message].filter((part) => part && part.length > 0).join("\n\n");
  const actionButtons = buttons ?? [];
  const confirmButton = pickConfirmButton(actionButtons);
  const needsConfirmation = actionButtons.some((button) => button.style === "cancel");

  if (!needsConfirmation) {
    globalThis.alert?.(prompt);
    confirmButton?.onPress?.();
    return;
  }

  if (globalThis.confirm?.(prompt)) {
    confirmButton?.onPress?.();
  }
}

export function installWebAlert() {
  if (Platform.OS !== "web") {
    return;
  }
  Alert.alert = alertOnWeb;
}
