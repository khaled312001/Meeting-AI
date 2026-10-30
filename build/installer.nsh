; Interprova installer pages: a welcome page that says what the app does,
; and a finish page with the first steps. Updates skip the welcome page.

!macro customWelcomePage
  !insertmacro skipPageIfUpdated
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Interprova"
  !define MUI_WELCOMEPAGE_TEXT "Interprova is your live AI assistant for interviews and meetings.$\r$\n$\r$\n- Hears the call in Arabic, English and German, even mixed$\r$\n- Writes a clear answer the moment you're asked$\r$\n- Builds answers on your own Instructions and Feed$\r$\n- Answers what's on your screen, such as a coding task$\r$\n$\r$\nFind jobs, build your CV and choose your plan at interprova.com.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!ifndef BUILD_UNINSTALLER
  !define MUI_FINISHPAGE_TITLE "Interprova is ready"
  !define MUI_FINISHPAGE_TEXT "Sign in with your account, upload your Instructions and Feed files, then press Start when the call begins.$\r$\n$\r$\nPress ? in focus mode to see what each button does.$\r$\n$\r$\nHelp, plans and updates: interprova.com"
!endif
