require 'digest'
require 'fileutils'

# The official sherpa-onnx iOS build, the version that desktop pins in scripts/prepare-voice.ts. It is
# one dynamic framework with ONNX Runtime linked in, published by k2-fsa under the `xcframework`
# release. It is fetched on `pod install` and checked against this hash; it is not in the repository.
SHERPA_ONNX_VERSION = '1.13.8'
SHERPA_ONNX_ARCHIVE = "sherpa-onnx-v#{SHERPA_ONNX_VERSION}-ios-shared-onnxruntime-static.xcframework.zip"
SHERPA_ONNX_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/xcframework/#{SHERPA_ONNX_ARCHIVE}"
SHERPA_ONNX_SHA256 = 'e259a7d3b38ad7dec49bb078252a30bb42ede8355e2bb130cf8c1c78ed131f75'

vendor = File.join(__dir__, 'vendor')
framework = File.join(vendor, 'SherpaOnnxC.xcframework')
marker = File.join(vendor, "#{SHERPA_ONNX_ARCHIVE}.verified")
unless File.exist?(marker) && File.directory?(framework)
  FileUtils.rm_rf(vendor)
  FileUtils.mkdir_p(vendor)
  archive = File.join(vendor, SHERPA_ONNX_ARCHIVE)
  system('curl', '--fail', '--location', '--silent', '--show-error', '--retry', '3', '--output', archive, SHERPA_ONNX_URL) ||
    raise("OpenBotSpeech: could not download #{SHERPA_ONNX_URL}")
  actual = Digest::SHA256.file(archive).hexdigest
  unless actual == SHERPA_ONNX_SHA256
    FileUtils.rm_rf(vendor)
    raise("OpenBotSpeech: #{SHERPA_ONNX_ARCHIVE} has SHA-256 #{actual}, expected #{SHERPA_ONNX_SHA256}")
  end
  system('unzip', '-q', '-o', archive, '-d', vendor) || raise("OpenBotSpeech: could not unzip #{SHERPA_ONNX_ARCHIVE}")
  FileUtils.rm_f(archive)
  File.write(marker, SHERPA_ONNX_SHA256)
end

Pod::Spec.new do |s|
  s.name           = 'OpenBotSpeech'
  s.version        = '1.0.0'
  s.summary        = 'Reads replies aloud for OpenBot'
  s.description    = 'Reads replies aloud with Supertonic 3 through sherpa-onnx on the phone, and plays speech audio.'
  s.license        = 'PolyForm-Noncommercial-1.0.0'
  s.author         = 'OpenBot'
  s.homepage       = 'https://openbot.run'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "*.swift"
  s.vendored_frameworks = 'vendor/SherpaOnnxC.xcframework'
  s.frameworks = 'AVFoundation'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
