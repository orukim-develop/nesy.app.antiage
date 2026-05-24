@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === nesy.app.health GitHub 푸시 ===
echo.
if exist ".git\config.lock" (
  echo [복구] sandbox 잔재 감지 - .git 폴더 정리 중...
  rmdir /s /q .git
)
if not exist ".git" (
  echo [1/5] git init -b main
  git init -b main
)
echo [2/5] git config
git config user.name "Oru Kim"
git config user.email "orukim@gmail.com"
echo [3/5] git add
git add nesy.yaml index.ts package.json tsconfig.json README.md .gitignore push.bat src
echo [4/5] git commit
git commit -m "feat: 건강 마도서 리빌드 - 자연어 goal + 3축 (운동/건강지표/식단)"
echo [5/5] git push
git remote remove origin 2>nul
git remote add origin https://github.com/orukim-develop/nesy.app.health.git
git push -u origin main
echo.
echo === 완료. 위에 에러 없으면 https://github.com/orukim-develop/nesy.app.health 에서 확인 ===
pause
