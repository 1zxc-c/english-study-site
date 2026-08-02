@echo off
chcp 65001 >nul
title 英语学习网站
cd /d "%~dp0"
echo 正在启动英语学习网站...
start "" "http://localhost:8668"
node server.js
pause
