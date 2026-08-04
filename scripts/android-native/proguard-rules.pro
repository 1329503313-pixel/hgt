# DCloud/fastjson 中包含面向可选 Java 服务端库的适配器，Android 运行时不会使用。
-ignorewarnings
-dontwarn java.awt.**
-dontwarn javax.money.**
-dontwarn javax.ws.rs.**
-dontwarn org.glassfish.jersey.**
-dontwarn org.javamoney.moneta.**
-dontwarn org.joda.time.**
-dontwarn pl.droidsonroids.gif.GifImageView
-dontwarn springfox.documentation.spring.web.json.Json

# uni-app x/UTS 通过反射注册页面和扩展 API，Release 压缩时必须保留。
-keep class io.dcloud.** { *; }
-keep class uts.sdk.** { *; }
-keep class com.alibaba.fastjson.** { *; }
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
