Pod::Spec.new do |s|
  s.name           = 'OpenBotRemoteViewerProxy'
  s.version        = '1.0.0'
  s.summary        = 'Loopback HTTP and WebSocket server for the OpenBot remote desktop viewer'
  s.description    = 'Listens on 127.0.0.1 and gives each HTTP request and WebSocket message to JavaScript, which sends it to the host.'
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
