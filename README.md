# ChatCinema Studio

Локальный прототип редактора вертикального видео из переписки. Подробная инструкция для Windows 11: [INSTALLATION.md](INSTALLATION.md). Состояние: [PROGRESS.md](PROGRESS.md); лицензии и происхождение звуков: [LICENSES.md](LICENSES.md).

## Установка и запуск

Проверены Windows x64, Node.js **24.15.0** и npm **11.12.1**. Установите эту версию Node.js, затем в PowerShell из корня проекта:

```powershell
node --version
npm --version
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

Откройте http://127.0.0.1:4173. Сервер запускается из исходного кода через Vite middleware; `npm run build` проверяет клиентскую production-сборку, но не создаёт самостоятельный установщик или production-сервер. Для установки и первого рендера нужен интернет: Remotion при необходимости загружает Chrome Headless Shell. FFmpeg и ffprobe для Windows x64 входят в установленный пакет Remotion. Остановить сервер: Ctrl+C.

Если порты заняты, перед запуском можно задать `$env:CHATCINEMA_PORT='4174'` и `$env:CHATCINEMA_HMR_PORT='24679'`, затем открыть указанный сервером адрес. Проекты хранятся в `data/projects/<id>/project.json`, экспорт — в `data/projects/<id>/exports/`; `.tmp` содержит временные файлы. Данные исключены из Git, но физически находятся внутри папки приложения — сохраняйте их отдельно при обновлении.

Чистая установка и два рендера проверены на одной Windows-машине, не на другом компьютере. После обновления зависимостей `npm audit` 2 ноября 2026 сообщил 0 уязвимостей; сведения могут измениться. Подробности и лицензионные ограничения — в [LICENSES.md](LICENSES.md).
