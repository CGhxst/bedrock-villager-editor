# Third-Party Notices

> **NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.**

## Project license

The Bedrock Villager Editor project source code is distributed under the MIT License.
See `LICENSE` for the full license text.

## Third-party software dependencies

Runtime and build dependencies remain subject to their own respective open-source licenses.
The `package-lock.json` file records the exact installed dependency graph for the release build.
This project's MIT License does not relicense or modify third-party software package licenses.

## Minecraft-derived assets

- The `public/assets` directory contains local item and block textures synchronized through the `minecraft-assets` package.
- `scripts/sync-all-versions.js` writes `public/assets/asset-provenance.json`, which records the selected source version for synchronized item/block texture paths.
- `public/asset-manifest.json` and its built `dist/public/asset-manifest.json` copy record packaged asset paths, byte sizes, and SHA-256 integrity hashes. They do not record source-version provenance.
- Asset provenance does not itself grant redistribution permission.
- Minecraft names, graphics, textures, and other game assets remain subject to Mojang and Microsoft terms and the Minecraft Usage Guidelines.
- These assets are NOT licensed under this project's MIT License.
- Stable public redistribution of a build containing those assets requires explicit release-owner review of the applicable Minecraft terms and guidelines and, when needed, legal advice or replacement/removal of those assets.
