Pod::Spec.new do |s|
  s.name           = 'OpenBotShortcuts'
  s.version        = '1.0.0'
  s.summary        = 'The link between the OpenBot shortcuts and JavaScript'
  s.description    = 'Gives the requests of the App Intents to JavaScript and the card of a shortcut session to the snippet.'
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
