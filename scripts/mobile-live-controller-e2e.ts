// Runs the production mobile call controller with deterministic native/audio boundaries.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "bun";

const output = resolve(".openbot-build/mobile-live-controller-e2e");
await mkdir(output, { recursive: true });
const native = resolve("scripts/fixtures/mobile-voice/controller-native.js");
const inert = `export const useMobileSession=()=>({session:null}),useVoiceSettings=()=>false,activateKeepAwakeAsync=async()=>{},deactivateKeepAwake=async()=>{},BackHandler={},speechNative={},haptics={impact:async()=>{},selection:async()=>{}},mobileAnalytics={track(){}},currentText=()=>({t:key=>key}),REPLY_VOICE_FAILURE_TEXT={},streamReply=()=>({stop(){},update(){}}),useVoiceDictation=()=>({}),cancelAnimation=()=>{},Easing={bezier:()=>({}),inOut:x=>x,ease:{}},ReduceMotion={System:0},useSharedValue=()=>({set(){}}),withRepeat=x=>x,withTiming=(x,_options,done)=>{done?.(true);return x},scheduleOnRN=fn=>fn();`;
await build({
  entrypoints: ["scripts/fixtures/mobile-voice/controller-driver.js"],
  outdir: output,
  naming: "driver.mjs",
  target: "bun",
  format: "esm",
  packages: "external",
  plugins: [
    {
      name: "native-boundaries",
      setup(b) {
        b.onResolve({ filter: /^@\/features\/voice\/model\/realtime-voice$/ }, () => ({ path: native }));
        b.onResolve(
          {
            filter:
              /^(expo-keep-awake|react-native|react-native-reanimated|react-native-worklets|@\/features\/auth\/context\/mobile-session-context|@\/features\/analytics\/mobile-analytics|@\/features\/voice\/model\/(reply-voice|speech-native|voice-settings)|@\/shared\/lib\/(haptics|text))$/,
          },
          (args) => ({ path: args.path, namespace: "native-fixture" }),
        );
        b.onResolve({ filter: /use-voice-dictation$/ }, () => ({ path: "dictation", namespace: "native-fixture" }));
        b.onLoad({ filter: /.*/, namespace: "native-fixture" }, () => ({ contents: inert, loader: "js" }));
      },
    },
  ],
});
let passed = false;
try {
  const result = JSON.parse(execFileSync(process.execPath, [`${output}/driver.mjs`], { encoding: "utf8" }));
  assert.equal(result.passed, true);
  passed = true;
  await writeFile(`${output}/report.json`, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  if (!passed) await writeFile(`${output}/report.json`, '{"passed":false}\n');
}
