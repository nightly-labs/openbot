Pod::Spec.new do |s|
  s.name           = 'OpenBotThemeSnapshot'
  s.version        = '1.0.0'
  s.summary        = 'Window picture for the OpenBot theme change'
  s.description    = 'Draws the whole window, sheets included, so the theme change can show the old theme over the new one.'
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
