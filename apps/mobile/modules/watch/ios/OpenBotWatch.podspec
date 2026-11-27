Pod::Spec.new do |s|
  s.name           = 'OpenBotWatch'
  s.version        = '1.0.0'
  s.summary        = 'The link between the OpenBot Apple Watch app and JavaScript'
  s.description    = 'Sends the agents to the paired Apple Watch and gives the requests of the watch to JavaScript.'
  s.license        = 'PolyForm-Noncommercial-1.0.0'
  s.author         = 'OpenBot'
  s.homepage       = 'https://openbot.run'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WatchConnectivity'

  s.source_files = "**/*.swift"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
