import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { Colors, Radius } from '@/constants/theme';

type TransparencyPreviewProps = {
  uri: string;
  height?: number;
  radius?: number;
};

const CELLS = 8;

/**
 * Şeffaf PNG'yi damalı zemin üzerinde gösterir; beyaz konturun görünür
 * olmasını sağlar.
 */
export function TransparencyPreview({
  uri,
  height = 220,
  radius = Radius.md,
}: TransparencyPreviewProps) {
  return (
    <View style={[styles.frame, { height, borderRadius: radius }]}>
      <View style={styles.checker}>
        {Array.from({ length: CELLS * CELLS }).map((_, index) => {
          const row = Math.floor(index / CELLS);
          const column = index % CELLS;
          const isDark = (row + column) % 2 === 1;
          return (
            <View
              key={index}
              style={[
                styles.cell,
                {
                  width: `${100 / CELLS}%`,
                  height: `${100 / CELLS}%`,
                  backgroundColor: isDark ? Colors.checkerB : Colors.checkerA,
                },
              ]}
            />
          );
        })}
      </View>
      <Image source={{ uri }} style={styles.image} contentFit="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.paperLine,
    backgroundColor: Colors.checkerA,
  },
  checker: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    // Hücreler yüzde ile yerleşir.
  },
  image: {
    ...StyleSheet.absoluteFill,
    margin: 14,
  },
});
