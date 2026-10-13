@echo off
cd /d "%~dp0"
echo Missed Money demo server. Close this window to stop the app.
".venv\Scripts\python.exe" -m streamlit run app\main.py --server.port 8501 --server.address 127.0.0.1 --server.headless true --browser.gatherUsageStats false
pause
