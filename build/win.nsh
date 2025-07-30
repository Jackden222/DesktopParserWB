; Дополнительные настройки для Windows иконок
!macro customShortcutIcon
  ; Устанавливаем иконку для ярлыков
  SetOutPath "$INSTDIR"
  File "build\icon.ico"
  
  ; Создаем ярлык с правильной иконкой
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe" "" "$INSTDIR\icon.ico"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe" "" "$INSTDIR\icon.ico"
!macroend

!macro customUninstallShortcutIcon
  ; Удаляем ярлыки при деинсталляции
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${PRODUCT_NAME}"
!macroend 