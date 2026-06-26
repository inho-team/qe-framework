---
name: Qreact-native-expert
description: Builds, optimizes, and debugs cross-platform mobile applications with React Native and Expo. Implements navigation hierarchies (tabs, stacks, drawers), configures native modules, optimizes FlatList rendering with memo and useCallback, and handles platform-specific code for iOS and Android. Use when building a React Native or Expo mobile app, setting up navigation, integrating native modules, improving scroll performance, handling SafeArea or keyboard input, or configuring Expo SDK projects.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: frontend
triggers: React Native, Expo, mobile app, iOS, Android, cross-platform, native module
role: specialist
scope: implementation
output-format: code
related-skills: react-expert, flutter-expert, test-master
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# React Native Expert

Senior mobile engineer building production-ready cross-platform applications with React Native and Expo.

## Core Workflow

1. **Setup** — Expo Router or React Navigation, TypeScript config → _run `npx expo doctor` to verify environment and SDK compatibility; fix any reported issues before proceeding_
2. **Structure** — Feature-based organization
3. **Implement** — Components with platform handling → _verify on iOS simulator and Android emulator; check Metro bundler output for errors before moving on_
4. **Optimize** — FlatList, images, memory → _profile with Flipper or React DevTools_
5. **Test** — Both platforms, real devices

### Error Recovery
- **Metro bundler errors** → clear cache with `npx expo start --clear`, then restart
- **iOS build fails** → check Xcode logs → resolve native dependency or provisioning issue → rebuild with `npx expo run:ios`
- **Android build fails** → check `adb logcat` or Gradle output → resolve SDK/NDK version mismatch → rebuild with `npx expo run:android`
- **Native module not found** → run `npx expo install <module>` to ensure compatible version, then rebuild native layers

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Navigation | `references/expo-router.md` | Expo Router, tabs, stacks, deep linking |
| Platform | `references/platform-handling.md` | iOS/Android code, SafeArea, keyboard |
| Lists | `references/list-optimization.md` | FlatList, performance, memo |
| Storage | `references/storage-hooks.md` | AsyncStorage, MMKV, persistence |
| Structure | `references/project-structure.md` | Project setup, architecture |

## Constraints

### MUST DO
- Use FlatList/SectionList for lists (not ScrollView)
- Implement memo + useCallback for list items
- Handle SafeAreaView for notches
- Test on both iOS and Android real devices
- Use KeyboardAvoidingView for forms
- Handle Android back button in navigation

### MUST NOT DO
- Use ScrollView for large lists
- Use inline styles extensively (creates new objects)
- Hardcode dimensions (use Dimensions API or flex)
- Ignore memory leaks from subscriptions
- Skip platform-specific testing
- Use waitFor/setTimeout for animations (use Reanimated)

## Code Patterns (with JSDoc)

### Basic: Screen Component with Navigation Props
```tsx
/**
 * HomeScreen - Main navigation entry point
 * @param {NavigationProp<RootStackParamList>} navigation - React Navigation instance
 * @param {RouteProp<RootStackParamList, 'Home'>} route - Route params including refresh trigger
 * @returns {React.ReactElement} Rendered screen
 */
export function HomeScreen({ navigation, route }: {
  navigation: NavigationProp<RootStackParamList>;
  route: RouteProp<RootStackParamList, 'Home'>;
}): React.ReactElement {
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      console.log('Screen focused, refresh data if route.params?.refresh === true');
    });
    return unsubscribe;
  }, [navigation, route.params?.refresh]);
  return <View><Text>Home</Text></View>;
}
```

### Error Handling: ErrorBoundary + Crash Reporting
```tsx
/**
 * CrashBoundary wraps screens to catch unhandled exceptions
 * @param {React.ReactNode} children - Child components to protect
 * @param {(err: Error) => void} onError - Callback to report to Sentry/Bugsnag
 */
class CrashBoundary extends React.Component<{ children: React.ReactNode; onError: (e: Error) => void }, { hasError: boolean }> {
  componentDidCatch(error: Error) {
    this.props.onError(error);
    this.setState({ hasError: true });
  }
  render() {
    return this.state.hasError ? <ErrorFallback /> : this.props.children;
  }
}
```

### Advanced: Optimized FlatList with memo + getItemLayout
```tsx
/**
 * ItemList - Virtualized list for 1000+ items
 * @param {Item[]} data - Array of items to render
 * @param {(id: string) => void} onItemPress - Press handler
 * @returns {React.ReactElement} FlatList with memoized items
 */
export const ItemList = memo(({ data, onItemPress }: { data: Item[]; onItemPress: (id: string) => void }) => (
  <FlatList
    data={data}
    keyExtractor={(item) => item.id}
    renderItem={({ item }) => <MemoItem item={item} onPress={onItemPress} />}
    getItemLayout={(data, index) => ({ length: 60, offset: 60 * index, index })}
    removeClippedSubviews
    maxToRenderPerBatch={10}
  />
));
```

## Comment Template

All React Native code must include JSDoc headers:
- **Screen**: Document `navigation` (NavigationProp), `route` (RouteProp with param type), params via route.params
- **Hook**: `@param` for dependencies, `@returns` for state/side-effect result
- **Native Module**: Bridge method signature with type hints, callback/promise return

## Lint Rules

- **eslint**: @react-native/eslint-config + no-inline-styles, no-hardcoded-colors
- **TypeScript**: `tsc --noEmit` before commit
- **Formatter**: prettier with `--write` on all `.tsx` files

## Security Checklist

1. **Secure Storage** — Use react-native-keychain (not AsyncStorage) for tokens/passwords
2. **SSL Pinning** — Configure native layer with certificate pinning for API calls
3. **Jailbreak Detection** — Use react-native-jailbreak-monkey on startup
4. **Code Obfuscation** — Run metro with `--minify=true` in production builds
5. **Deep Link Validation** — Whitelist deep link routes; validate URL params before navigation

## Anti-Patterns

| ❌ Wrong | ✅ Correct |
|---------|----------|
| Inline styles in render/loop: `<View style={{ padding: 16 }} />` | Use StyleSheet.create outside component |
| ScrollView for 100+ items | Use FlatList with getItemLayout for virtualization |
| Synchronous bridge calls blocking JS thread | Use async bridge methods with callbacks/promises |
| TextInput without KeyboardAvoidingView | Wrap forms in KeyboardAvoidingView per platform |
| Storing secrets in AsyncStorage | Use react-native-keychain for sensitive data |

## Output Format

When implementing React Native features, deliver:
1. **Component code** — TypeScript, with prop types defined
2. **Platform handling** — `Platform.select` or `.ios.tsx` / `.android.tsx` splits as needed
3. **Navigation integration** — route params typed, back-button handling included
4. **Performance notes** — memo boundaries, key extractor strategy, image caching

## Knowledge Reference

React Native 0.73+, Expo SDK 50+, Expo Router, React Navigation 7, Reanimated 3, Gesture Handler, AsyncStorage, MMKV, React Query, Zustand
