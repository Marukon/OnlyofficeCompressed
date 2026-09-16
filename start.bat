@echo off
chcp 65001 >nul
echo 正在启动 ONLYOFFICE 本地调试服务...
python serve.py
pause
