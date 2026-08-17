import { Image, StyleSheet, Text, View } from "react-native";

import { colors } from "@/theme/colors";

type AvatarProps = {
  uri?: string | null;
  name?: string | null;
  size?: number;
};

export function Avatar({ uri, name, size = 44 }: AvatarProps) {
  const initials = (name ?? "?").trim().slice(0, 1).toUpperCase() || "?";
  if (uri && uri.trim().length > 0) {
    return <Image source={{ uri: uri.trim() }} style={[styles.image, { height: size, width: size, borderRadius: size / 2 }]} />;
  }
  return (
    <View style={[styles.fallback, { height: size, width: size, borderRadius: size / 2 }]}>
      <Text style={[styles.initials, { fontSize: Math.max(14, size * 0.38) }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: colors.surfaceElevated
  },
  fallback: {
    alignItems: "center",
    backgroundColor: colors.accentMuted,
    justifyContent: "center"
  },
  initials: {
    color: colors.accentSoft,
    fontWeight: "800"
  }
});
