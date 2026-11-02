Pod::Spec.new do |s|
  s.name           = 'OpenBotAppLock'
  s.version        = '1.0.0'
  s.summary        = 'App lock signals for OpenBot'
  s.description    = 'Measures the time that the app is away and tells when the phone locks, so the app can lock itself.'
  s.license        = 'PolyForm-Noncommercial-1.0.0'
  s.author         = 'OpenBot'
  s.homepage       = 'https://openbot.run'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.swift"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
