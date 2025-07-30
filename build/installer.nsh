!macro customInstall
  ; Отключаем проверку процессов
  !define MULTIUSER_EXECUTIONLEVEL "CurrentUser"
  !define MULTIUSER_INSTALLMODE_INSTDIR "${PRODUCT_NAME}"
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_KEY "Software\${PRODUCT_NAME}"
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_VALUENAME "InstallLocation"
  
  ; Настройки иконки для приложения
  !define APP_ICON "${PRODUCT_FILENAME}.exe"
  !define SHORTCUT_ICON "${PRODUCT_FILENAME}.exe"
  
  ; Устанавливаем иконку для ярлыков
  !define SHORTCUT_ICON_PATH "$INSTDIR\${PRODUCT_FILENAME}.exe"
  
  ; Создаем ярлык на рабочем столе с правильной иконкой
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe" "" "$INSTDIR\${PRODUCT_FILENAME}.exe" 0
  
  ; Создаем ярлык в меню Пуск с правильной иконкой
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe" "" "$INSTDIR\${PRODUCT_FILENAME}.exe" 0
  
  ; Очищаем кэш иконок Windows
  System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  ; Удаляем ярлыки
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${PRODUCT_NAME}"
  
  ; Очищаем кэш иконок Windows
  System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

; Отключаем проверку процессов глобально
!ifndef MULTIUSER_INSTALLMODE_NO_RUNNING_APPS_CHECK
  !define MULTIUSER_INSTALLMODE_NO_RUNNING_APPS_CHECK
!endif 