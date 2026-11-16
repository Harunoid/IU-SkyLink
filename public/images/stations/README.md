# Station photos

Site survey photos and concept composites shown in each station's survey panel.

1. Save the image here, about 1600 px wide, as `.jpg` or `.webp`. Name it after the station id, for example `stadium-1.jpg`.
2. List it under that station in `public/data/stations.json`:

   ```json
   "photos": [
     { "url": "images/stations/stadium-1.jpg", "caption": "North Terminal site inspection", "credit": "Harun" }
   ]
   ```

`url` is relative to the `public/` folder. `caption` and `credit` are optional. A station with no photos shows its survey data card instead.
