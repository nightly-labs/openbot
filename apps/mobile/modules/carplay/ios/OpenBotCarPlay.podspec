Pod::Spec.new do |s|
  s.name           = 'OpenBotCarPlay'
  s.version        = '1.0.0'
  s.summary        = 'The CarPlay screens of OpenBot'
  s.description    = 'Shows the pinned agents, the agents with new messages and a voice session on the car screen.'
  s.license        = 'PolyForm-Noncommercial-1.0.0'
  s.author         = 'OpenBot'
  s.homepage       = 'https://openbot.run'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.swift"
  s.frameworks = 'CarPlay'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
