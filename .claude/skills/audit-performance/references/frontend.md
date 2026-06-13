# Frontend performance audit checklist

Load this reference when reviewing components, screens, client-side logic, data fetching hooks, or styling code.

## Bundle size

- **Unnecessary imports** — importing an entire library when only one function is needed (`import _ from 'lodash'` vs `import debounce from 'lodash/debounce'`). Flag if the library does not support tree shaking natively.
- **Heavy dependencies** — a new dependency added to solve something achievable with a lighter alternative or a small inline implementation. Check if it was approved per the dependencies policy.
- **Missing code splitting** — large components or routes loaded eagerly that are not needed on initial render. Dynamic imports (`import()`) should be used for routes, modals, and heavy components behind interactions.
- **Duplicate dependencies** — multiple versions of the same library bundled due to mismatched peer dependencies. Flag if visible in the code; full detection requires bundle analysis tooling.
- **Dead code** — exported functions, components, or constants that are never imported anywhere in the codebase.

## Rendering

- **Unnecessary re-renders** — a component re-renders on every parent render when its props and state have not changed. Flag when the component is expensive to render (large lists, complex calculations, many children) and stabilizing props or memoization would help.
- **Unstable references** — objects, arrays, or functions created inline in JSX or render that cause child components to re-render on every cycle (`style={{ margin: 0 }}`, `onClick={() => handler()}` passed to memoized children).
- **Missing memoization on expensive computations** — derived values computed on every render from large datasets without `useMemo` or equivalent.
- **Incorrect memoization** — `useMemo` or `useCallback` applied to trivially cheap operations, adding overhead without benefit. Also flag dependency arrays that are incorrect or incomplete.
- **Components that should be static** — a component with no props, no state, and no context that is defined inside another component, causing re-instantiation on every render.
- **Large lists without virtualization** — rendering hundreds or thousands of DOM nodes when only a viewport-sized subset is visible. Flag when the list is known to be large or unbounded.

## Data fetching

- **Request waterfalls** — a fetch that only starts after a previous fetch completes, when both could run in parallel. Common pattern: sequential `await` calls for independent data.
- **Fetches in loops** — issuing one request per item in an array instead of a single batched request.
- **Missing loading states** — blocking the entire UI while data loads instead of showing partial content or skeletons. Already covered by ux-ui-designer spec — flag if the implementation does not match.
- **Fetching more data than needed** — requesting full objects when only a few fields are used. Flag if the API supports field selection and the code does not use it.
- **Missing cache** — the same data fetched repeatedly across components or navigations with no caching layer (SWR, React Query, server cache, or equivalent). Flag when the data is stable and the fetch is on a hot path.
- **Over-fetching on mutation** — refetching entire collections after a mutation when only the affected item needs updating.

## Images and assets

- **Missing lazy loading** — images below the fold loaded eagerly without `loading="lazy"` or framework equivalent.
- **Missing explicit dimensions** — images without `width` and `height` attributes cause layout shifts (CLS). Flag when dimensions are known at build time.
- **Unoptimized formats** — JPEG or PNG used where WebP or AVIF would be significantly smaller, when the framework or build pipeline supports conversion. Flag as a suggestion; format decisions require project-level confirmation.
- **Missing responsive sizes** — a single large image served to all viewports when `srcset` or framework image components could serve appropriately sized variants.
- **Render-blocking assets** — scripts or stylesheets loaded synchronously in `<head>` that block first paint and are not critical for above-the-fold content.

## Core Web Vitals patterns

### LCP (Largest Contentful Paint)

- Hero images or above-the-fold images not preloaded (`<link rel="preload">` or framework equivalent).
- Server-side rendering or static generation not used for above-the-fold content when the framework supports it.
- Large render-blocking resources delaying first meaningful paint.

### INP (Interaction to Next Paint)

- Heavy synchronous work in event handlers (sorting, filtering, transforming large arrays) running on the main thread during user interaction. Flag when the dataset is known to be large.
- Animations or transitions implemented with JavaScript instead of CSS where CSS would suffice.
- Input handlers that trigger expensive re-renders synchronously without debounce or throttle.

### CLS (Cumulative Layout Shift)

- Images, iframes, or embeds without explicit dimensions causing layout shifts on load.
- Dynamically injected content (banners, toasts, ads) that pushes existing content down instead of overlaying it.
- Font loading without `font-display: swap` or size-consistent fallback fonts, causing layout shifts when the custom font loads.
