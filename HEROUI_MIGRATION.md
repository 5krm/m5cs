# HeroUI v2 migration (work in progress)

This branch migrates the BMW M5 CS vehicle configurator to HeroUI v2 components. It adds a HeroUI provider, the Tailwind v4 HeroUI plugin, and the primary floating dock, finish selectors, camera/view controls, and scene picker. The Three.js scene, model, audio, and other app logic are preserved.

## Required before merging to main

Run the following from a real repository checkout with npm registry access:

    npm install
    npm run typecheck
    npm run lint
    npm run test
    npm run build

Commit the regenerated package-lock.json from npm install. Until the lockfile is updated, npm ci will fail because package.json now adds @heroui/react. This is a partial migration: older shadcn/Radix UI source files and some header/modal controls remain intentionally unchanged.

HeroUI v2 is used (not v3), because this code uses its Button/CardBody/Chip/Tooltip APIs.
