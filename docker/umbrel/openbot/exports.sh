export APP_OPENBOT_APPARMOR_PROFILE="docker-default"
if [ -r /sys/kernel/security/apparmor/profiles ] && grep -Fqx "docker-__APP_ID__ (enforce)" /sys/kernel/security/apparmor/profiles 2>/dev/null; then
  export APP_OPENBOT_APPARMOR_PROFILE="docker-__APP_ID__"
fi
