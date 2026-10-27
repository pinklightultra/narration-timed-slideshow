@echo off
start "" "http://127.0.0.1:8429"
node "%~dp0server.js" --port 8429
