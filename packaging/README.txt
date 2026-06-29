Eggshell Mold Maker — local test build (Windows)
================================================

WHAT IT IS
  Turns a part STL (e.g. an egg) into a watertight, resin-printable crush mold:
  shell it to a wall thickness, click to place a fill port + vents, save the mold STL.
  Everything runs on your own PC. Nothing is uploaded; no internet needed.

HOW TO RUN
  1. Unzip this whole folder somewhere (e.g. your Desktop).
  2. Double-click  start.bat
  3. A browser tab opens automatically — that's the app.
     Keep the small black window open while using it; close it to stop.

  Works best in Chrome or Microsoft Edge.

HOW TO USE
  1. Click "Open egg STL..." and choose an STL.
       (A sample 'egg.stl' is included in this folder to try.)
  2. Set the wall thickness, then click "Generate shell".
  3. Click the "Vent" or "Fill port" tool, then click on the shell surface to
     place them. Right-click a marker to delete it.
  4. Click "Bake & Save mold STL" to save the finished watertight mold.

TIPS
  - Vents double as resin drain points — place them at the high spots.
  - Default sizes: 2 mm wall, 1 mm vents, 3 mm fill bore (all adjustable).

IF start.bat IS BLOCKED BY WINDOWS
  - Right-click start.bat > Properties > tick "Unblock" > OK, then try again.
  - Or right-click start.bat > Run.
  - Or open PowerShell in this folder and run:
        powershell -ExecutionPolicy Bypass -File serve.ps1

WHAT'S IN HERE
  start.bat    <- double-click this
  serve.ps1    <- the tiny local web server (no install needed)
  app\         <- the application files
  egg.stl      <- a sample part to test with
