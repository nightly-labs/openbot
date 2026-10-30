# The sherpa-onnx native library reads the fields and calls the methods of its Kotlin classes by name
# through JNI, for example OfflineRecognizerConfig.decodingMethod. R8 must keep their names, or the
# release build fails to load a model with NoSuchFieldError. The AAR from JitPack has no rules of its own.
-keep class com.k2fsa.sherpa.onnx.** { *; }
