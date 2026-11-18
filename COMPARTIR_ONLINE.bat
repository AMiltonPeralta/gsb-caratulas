@echo off
title Compartir Caratulas Online - Gruas San Blas
echo ========================================================
echo   GRUAS SAN BLAS - CONEXION ONLINE PARA TESTEAR
echo ========================================================
echo.
echo Iniciando tunel seguro de Cloudflare hacia tu servidor local...
echo La direccion publica aparecera abajo terminada en .trycloudflare.com
echo.
"%~dp0cloudflared.exe" tunnel --url http://127.0.0.1:3000
pause
