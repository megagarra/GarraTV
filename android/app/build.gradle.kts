import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Created by scripts/package-android.mjs; absent on a fresh clone, where only debug builds work.
val keystoreProps = Properties().apply {
    val file = rootProject.file("keystore/keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

// The app ships with the web/server release it was built from.
val appVersionName = (project.findProperty("appVersionName") as String?)
    ?: Regex("\"version\"\\s*:\\s*\"([^\"]+)\"").find(rootProject.file("../package.json").readText())?.groupValues?.get(1)
    ?: "1.0.0"

/** 1.21.3 → 12103: monotonic as long as minor/patch stay below 100. */
fun versionCodeOf(name: String): Int {
    val parts = name.split('.').map { it.toIntOrNull() ?: 0 } + listOf(0, 0, 0)
    return parts[0] * 10000 + parts[1] * 100 + parts[2]
}

android {
    namespace = "com.garratv.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.garratv.app"
        minSdk = 24
        targetSdk = 35
        versionCode = versionCodeOf(appVersionName)
        versionName = appVersionName
    }

    signingConfigs {
        if (keystoreProps.containsKey("storeFile")) {
            create("release") {
                storeFile = rootProject.file("keystore/${keystoreProps.getProperty("storeFile")}")
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    androidResources {
        // The exported web bundle has files and folders starting with "_" (Next's
        // `_next/`, the `_` placeholder pages) that aapt would otherwise drop.
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~"
    }
}

dependencies {
    // SQLite compiled into the app: same engine everywhere (JSON1 included), unlike
    // the platform's, whose version and features depend on the Android release.
    implementation("androidx.sqlite:sqlite-bundled:2.5.2")
}
