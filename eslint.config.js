const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'node_modules/*'],
  },
  {
    // Reanimated SharedValue'ları worklet geri çağrılarında bilinçli olarak
    // mutate ediyoruz; React Compiler kuralları bu deseni yanlış pozitif
    // olarak işaretliyor.
    files: ['src/components/ObjectCutter.tsx'],
    rules: {
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
    },
  },
]);
