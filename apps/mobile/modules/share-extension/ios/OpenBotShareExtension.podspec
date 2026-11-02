Pod::Spec.new do |s|
  s.name           = 'OpenBotShareExtension'
  s.version        = '1.0.0'
  s.summary        = 'Share extension data for OpenBot'
  s.description    = 'Gives the share extension the session of the app, and offers agents in the share sheet.'
  s.license        = 'PolyForm-Noncommercial-1.0.0'
  s.author         = 'OpenBot'
  s.homepage       = 'https://openbot.run'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.swift"
  s.frameworks = 'Intents', 'Security'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
