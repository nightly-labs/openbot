const { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { IOSConfig, withAndroidManifest, withDangerousMod, withXcodeProject } = require("expo/config-plugins");

// The app icons that the user can select in Settings > Appearance > App icon (`modules/app-icon`).
// They are the logo colors of the desktop app (`packages/contracts/src/app-logo-color.ts`): the body
// color with the released eyes. The default color is the main icon of `app.json`.
//
// iOS: each other color is a copy of the main Icon Composer file (`ios.icon`) with that body color.
// In dark mode the icon keeps the dark body of the main icon, and the eyes take the color. Xcode
// compiles each file named in `ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES`, and
// `UIApplication.setAlternateIconName` selects it.
//
// Android: the launcher shows the enabled `activity-alias` of `MainActivity`, so the main activity
// loses its launcher filter and each color gets an alias. `MainActivity` keeps its other filters, so
// links and notifications open it directly. The other colors draw the foreground of the main adaptive
// icon on the body color, as the desktop icons do.

// Node 24 strips the types of the contracts file. It has no imports.
const {
  APP_LOGO_COLORS,
  APP_LOGO_COLOR_HEX,
  DEFAULT_APP_LOGO_COLOR,
} = require("../../../packages/contracts/src/app-logo-color.ts");

const ALIAS_PREFIX = ".AppIcon";

/** @param {string} id */
const pascal = (id) => id.charAt(0).toUpperCase() + id.slice(1);
/** @param {string} id */
const iosIconName = (id) => `AppIcon${pascal(id)}`;

/** The colors other than the main icon, in the order of the desktop picker. */
function alternateColors() {
  return APP_LOGO_COLORS.filter((color) => color !== DEFAULT_APP_LOGO_COLOR).map((id) => {
    if (!/^[a-z][a-z0-9]*$/.test(id)) throw new Error(`with-app-icons: bad color id "${id}"`);
    return { id, hex: APP_LOGO_COLOR_HEX[id] };
  });
}

/** @param {string} hex @param {number} factor */
function channels(hex, factor = 1) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((index) => Math.min(1, (Number.parseInt(value.slice(index, index + 2), 16) / 255) * factor));
}

/** @param {number[]} rgb */
const displayP3 = (rgb) => `display-p3:${rgb.map((channel) => channel.toFixed(5)).join(",")},1.00000`;

/** The Icon Composer document of a color: the main document with that body and dark-mode eyes. */
function variantIconJson(main, hex) {
  const document = structuredClone(main);
  const fills = document["fill-specializations"] ?? [];
  const darkFill = fills.find((fill) => fill.appearance === "dark");
  document["fill-specializations"] = [
    {
      value: {
        "linear-gradient": [displayP3(channels(hex, 1.04)), displayP3(channels(hex, 0.86))],
        orientation: { start: { x: 0.5, y: 0 }, stop: { x: 0.5, y: 0.7 } },
      },
    },
    ...(darkFill ? [darkFill] : []),
  ];
  for (const group of document.groups ?? []) {
    for (const layer of group.layers ?? []) {
      layer["fill-specializations"] = [
        { value: "automatic" },
        { appearance: "dark", value: { solid: displayP3(channels(hex)) } },
      ];
    }
  }
  return document;
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withIosAppIcons = (config) => {
  config = withDangerousMod(config, [
    "ios",
    (config) => {
      const { projectRoot, platformProjectRoot, projectName } = config.modRequest;
      const mainIcon = config.ios?.icon;
      if (typeof mainIcon !== "string" || !mainIcon.endsWith(".icon")) {
        throw new Error("with-app-icons: ios.icon must be an Icon Composer file");
      }
      const source = resolve(projectRoot, mainIcon);
      const main = JSON.parse(readFileSync(join(source, "icon.json"), "utf8"));
      for (const { id, hex } of alternateColors()) {
        const target = join(platformProjectRoot, projectName, `${iosIconName(id)}.icon`);
        rmSync(target, { recursive: true, force: true });
        cpSync(source, target, { recursive: true });
        writeFileSync(join(target, "icon.json"), `${JSON.stringify(variantIconJson(main, hex), null, 2)}\n`);
      }
      return config;
    },
  ]);
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const { projectName } = config.modRequest;
    const names = alternateColors().map(({ id }) => iosIconName(id));
    for (const name of names) {
      const filepath = `${projectName}/${name}.icon`;
      if (project.hasFile(filepath)) continue;
      IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath,
        groupName: projectName,
        project,
        isBuildFile: true,
        verbose: true,
      });
    }
    const [, target] = IOSConfig.Target.findNativeTargetByName(project, projectName);
    for (const [, build] of IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
      project,
      target.buildConfigurationList,
    )) {
      if (!build?.buildSettings) continue;
      build.buildSettings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = `"${names.join(" ")}"`;
      build.buildSettings.ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS = "YES";
    }
    return config;
  });
};

const drawableName = (id) => `openbot_app_icon_${id}`;

function androidDrawables({ id, hex }) {
  const name = drawableName(id);
  const background = `<?xml version="1.0" encoding="utf-8"?>
<color xmlns:android="http://schemas.android.com/apk/res/android" android:color="#FF${hex.replace("#", "").toUpperCase()}" />
`;
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@drawable/${name}_background" />
  <foreground android:drawable="@mipmap/ic_launcher_foreground" />
  <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
`;
  // Android 7 has no adaptive icons: the layers show as one square image.
  const legacy = `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
  <item android:drawable="@drawable/${name}_background" />
  <item android:drawable="@mipmap/ic_launcher_foreground" />
</layer-list>
`;
  return [
    ["drawable", `${name}_background.xml`, background],
    ["drawable", `${name}.xml`, legacy],
    ["drawable-anydpi-v26", `${name}.xml`, adaptive],
  ];
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withAndroidAppIcons = (config) => {
  config = withDangerousMod(config, [
    "android",
    (config) => {
      const res = join(config.modRequest.platformProjectRoot, "app", "src", "main", "res");
      for (const color of alternateColors()) {
        for (const [folder, file, content] of androidDrawables(color)) {
          const directory = join(res, folder);
          if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
          writeFileSync(join(directory, file), content);
        }
      }
      return config;
    },
  ]);
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    const main = application?.activity?.find((activity) => activity.$["android:name"] === ".MainActivity");
    if (!application || !main) throw new Error("with-app-icons: MainActivity not found");
    const isLauncher = (filter) =>
      filter.action?.some((action) => action.$["android:name"] === "android.intent.action.MAIN") &&
      filter.category?.some((category) => category.$["android:name"] === "android.intent.category.LAUNCHER");
    main["intent-filter"] = (main["intent-filter"] ?? []).filter((filter) => !isLauncher(filter));
    const aliases = (application["activity-alias"] ?? []).filter(
      (alias) => !alias.$["android:name"].startsWith(ALIAS_PREFIX),
    );
    // `default` is the main icon. The module reads the alias names back as IDs.
    for (const id of ["default", ...alternateColors().map((color) => color.id)]) {
      const main = id === "default";
      const icon = main ? "@mipmap/ic_launcher" : `@drawable/${drawableName(id)}`;
      aliases.push({
        $: {
          "android:name": `${ALIAS_PREFIX}${pascal(id)}`,
          "android:targetActivity": ".MainActivity",
          "android:enabled": main ? "true" : "false",
          "android:exported": "true",
          "android:icon": icon,
          "android:roundIcon": main ? "@mipmap/ic_launcher_round" : icon,
        },
        "intent-filter": [
          {
            action: [{ $: { "android:name": "android.intent.action.MAIN" } }],
            category: [{ $: { "android:name": "android.intent.category.LAUNCHER" } }],
          },
        ],
      });
    }
    application["activity-alias"] = aliases;
    return config;
  });
};

/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = (config) => withAndroidAppIcons(withIosAppIcons(config));
