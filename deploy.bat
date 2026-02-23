@echo off
chcp 65001 >nul
title LinguaVox — Deploy to GitHub Pages

echo.
echo  ==========================================
echo   LinguaVox - Деплой на GitHub Pages
echo  ==========================================
echo.
echo  Сейчас откроется браузер для входа в GitHub.
echo  Следуй инструкциям на экране.
echo.
pause

:: Шаг 1 — авторизация
"C:\Program Files\GitHub CLI\gh.exe" auth login --web -h github.com
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  Ошибка при входе. Попробуй снова.
    pause
    exit /b 1
)

echo.
echo  Создаём репозиторий translator2.0 на GitHub...
"C:\Program Files\GitHub CLI\gh.exe" repo create Aiba20/translator2.0 --public
if %ERRORLEVEL% NEQ 0 (
    echo  Возможно репозиторий уже существует - продолжаем...
)

echo.
echo  Загружаем файлы...
git -C "C:\Users\user\Desktop\translator 2.0" push -u origin main
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ОШИБКА: push не удался. Проверь конфликты вручную.
    echo  Если нужно, выполни: git pull --rebase origin main
    pause
    exit /b 1
)

echo.
echo  Включаем GitHub Pages...
"C:\Program Files\GitHub CLI\gh.exe" api repos/Aiba20/translator2.0/pages --method POST -F "source[branch]=main" -F "source[path]=/" 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo  Pages уже был включён или включается...
)

echo.
echo  ==========================================
echo.
echo  Готово! Твой сайт будет доступен через
echo  1-2 минуты по ссылке:
echo.
echo  https://aiba20.github.io/translator2.0
echo.
echo  Открываю страницу на GitHub...
timeout /t 3 /nobreak >nul
start "" "https://aiba20.github.io/translator2.0"

echo.
pause
