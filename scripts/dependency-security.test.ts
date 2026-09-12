// @vitest-environment node
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// A subprocess deadline keeps a parser regression from blocking the test runner.
function runDependency(code: string): string {
  const result = spawnSync(process.execPath, ["-e", code], { encoding: "utf8", timeout: 5_000 });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return result.stdout.trim();
}

describe("dependency security patches", () => {
  it("rejects non-advancing ICNS, HEIF, and JXL entries without blocking image processing", () => {
    expect(
      runDependency(`
      const assert = require('node:assert/strict');
      const size = require('image-size');
      const icns = Buffer.alloc(16);
      icns.write('icns'); icns.writeUInt32BE(16, 4); icns.write('icp5', 8);
      assert.throws(() => size(icns), /Invalid ICNS entry length/);
      icns.writeUInt32BE(8, 12);
      assert.equal(size(icns).width, 32);
      const heif = Buffer.alloc(24);
      heif.writeUInt32BE(16); heif.write('ftyp', 4); heif.write('avif', 8);
      assert.throws(() => size(heif), /Invalid image box size/);
      const jxl = Buffer.alloc(36);
      jxl.writeUInt32BE(12); jxl.write('JXL ', 4);
      jxl.writeUInt32BE(16, 12); jxl.write('ftyp', 16); jxl.write('jxl ', 20);
      jxl.write('jxlp', 32);
      assert.throws(() => size(jxl), /Invalid image box size/);
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64');
      assert.equal(size(png).width, 1);
      console.log('images passed');
    `),
    ).toBe("images passed");
  });

  it("decodes malformed query input without recursion and preserves CommonJS callers", () => {
    expect(
      runDependency(`
      const assert = require('node:assert/strict');
      const decode = require('decode-uri-component');
      const malformed = '%FF'.repeat(20000);
      assert.equal(decode(malformed), malformed);
      assert.equal(decode('hello+world%20%C5%82'), 'hello world ł');
      assert.equal(require('query-string').parse('name=hello+world').name, 'hello world');
      console.log('queries passed');
    `),
    ).toBe("queries passed");
  });

  it("keeps Xcode identifiers and the native image dependency working after overrides", () => {
    expect(
      runDependency(`
      const assert = require('node:assert/strict');
      const project = require('xcode').project('/tmp/unused.pbxproj');
      project.hash = {project: {objects: {}}};
      assert.match(project.generateUuid(), /^[A-F0-9]{24}$/);
      const sharp = require('sharp');
      sharp({create: {width: 2, height: 3, channels: 4, background: '#ffffff'}})
        .png().toBuffer().then(bytes => sharp(bytes).metadata()).then(metadata => {
          assert.equal(metadata.width, 2);
          assert.equal(metadata.height, 3);
          console.log('consumers passed');
        }).catch(error => { console.error(error); process.exitCode = 1; });
    `),
    ).toBe("consumers passed");
  });
});
