!macro customInstall
  ; Отключаем проверку процессов через переопределение функций
  !define MULTIUSER_EXECUTIONLEVEL "CurrentUser"
  !define MULTIUSER_INSTALLMODE_INSTDIR "${PRODUCT_NAME}"
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_KEY "Software\${PRODUCT_NAME}"
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_VALUENAME "InstallLocation"
!macroend

!macro customUnInstall
  ; Пустой макрос
!macroend

; Отключаем проверку процессов глобально
!define MULTIUSER_INSTALLMODE_NO_RUNNING_APPS_CHECK 