A web app intended to recreate the many endings that The 25th Ward: The Silver Case's black out chapter offers, also allowing users to create their own, save them, and share them.

Recreated both the cylinder list that displays all the endings in a list that loops, the progression system that plays a video of the true ending after watching all 100 endings, and most importantly, the particle effect that makes the text "come together", and the "camera scrolling downwards" + audio flow from the endings.
You can export the result as a PNG (the whole chain) or as a video with audio (full playback with sound). Additional functionality has also been added that lets you:

- Choose different colors for the regular and final lines
- Upload an .mp3 file to use as a final line sound effect (only saved for the session but shows up if the ending is exported to video)

Custom endings are saved to the user's localStorage and exporting them downloads them to the user's computer as a .json file.

I used OCR to automatically grab the endings' textlines and put them into one organized document (endings.json), so there might be spelling and grammar mistakes as I didn't do a very throughout check of all of them.

## Notes
If you wanna run this locally, clone the repo and run npm run dev in the root of the project.
