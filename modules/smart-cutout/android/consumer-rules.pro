# MediaPipe / protobuf R8 kuralları
#
# MediaPipe, proto mesajlarını `GeneratedMessageLite` üzerinden reflection ile
# okuyor. R8 release derlemesinde bu sınıfların alanlarını yeniden adlandırınca
# çalışma anında "Field runAsync_ for q14 not found" gibi hatalar oluşuyor
# (bkz. BaseOptions proto → dahili grafiğe geçiş).
#
# APK boyutu bu projede öncelik değil, bu yüzden MediaPipe ve protobuf
# paketlerini olduğu gibi koruyoruz.

-keep class com.google.mediapipe.** { *; }
-keep interface com.google.mediapipe.** { *; }
-keepclassmembers class com.google.mediapipe.** { *; }
-dontwarn com.google.mediapipe.**

-keep class com.google.protobuf.** { *; }
-keep interface com.google.protobuf.** { *; }
-keepclassmembers class com.google.protobuf.** { *; }
-dontwarn com.google.protobuf.**

# Lite proto mesajlarının alanları reflection ile okunuyor.
-keepclassmembers class * extends com.google.protobuf.GeneratedMessageLite { <fields>; }
-keepclassmembers class * extends com.google.protobuf.GeneratedMessageLite$ExtendableMessage { *; }
-keepclassmembers class * extends com.google.protobuf.GeneratedMessageV3 { <fields>; }

# JNI köprüleri: native taraf sınıf/metot adlarını string olarak arıyor.
-keepclasseswithmembernames class * {
    native <methods>;
}
