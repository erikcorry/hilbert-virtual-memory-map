# Memory Map Generator

A vibe-coded node utility that takes a list of virtual memory regions and plots them as a 1024x2048 PNG.

The Hilbert curve is used to map addresses to pixels, so that any consecutive area is connected in the image.  Resolution is 1 pixel = 64Mbytes.  Tuned to the 47 bit user-space available on Linux.

![Example Memory Map](example.png)
