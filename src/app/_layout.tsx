import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';

SplashScreen.preventAutoHideAsync().catch(() => {
  // Splash zaten gizlenmiş olabilir.
});

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {
      // Geliştirme sırasında splash henüz hazır olmayabilir.
    });
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: Colors.paper },
          }}>
          <Stack.Screen name="index" />
          <Stack.Screen
            name="camera"
            options={{
              animation: 'slide_from_bottom',
              contentStyle: { backgroundColor: Colors.stage },
            }}
          />
          <Stack.Screen
            name="editor"
            options={{
              animation: 'slide_from_right',
              gestureEnabled: false,
              contentStyle: { backgroundColor: Colors.stage },
            }}
          />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.paper,
  },
});
