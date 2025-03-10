/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import Loadable from 'react-loadable';
import Loading from '@theme/Loading';
import routesChunkNames from '@generated/routesChunkNames';
import registry from '@generated/registry';
import flat from '../flat';
import {RouteContextProvider} from '../routeContext';

declare global {
  interface NodeRequire {
    resolveWeak: (name: string) => number;
  }
}

export default function ComponentCreator(
  path: string,
  hash: string,
): ReturnType<typeof Loadable> {
  // 404 page
  if (path === '*') {
    return Loadable({
      loading: Loading,
      loader: () => import('@theme/NotFound'),
      modules: ['@theme/NotFound'],
      webpack: () => [require.resolveWeak('@theme/NotFound')],
      render(loaded, props) {
        const NotFound = loaded.default;
        return (
          <RouteContextProvider
            // Do we want a better name than native-default?
            value={{plugin: {name: 'native', id: 'default'}}}>
            <NotFound {...(props as JSX.IntrinsicAttributes)} />
          </RouteContextProvider>
        );
      },
    });
  }

  const chunkNames = routesChunkNames[`${path}-${hash}`]!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loader: {[key: string]: () => Promise<any>} = {};
  const modules: string[] = [];
  const optsWebpack: string[] = [];

  // A map from prop names to chunk names.
  // e.g. Suppose the plugin added this as route:
  //   { __comp: "...", prop: { foo: "..." }, items: ["...", "..."] }
  // It will become:
  //   { __comp: "...", "prop.foo": "...", "items.0": "...", "items.1": ... }
  // Loadable.Map will _map_ over `loader` and load each key.
  const flatChunkNames = flat(chunkNames);
  Object.entries(flatChunkNames).forEach(([keyPath, chunkName]) => {
    const chunkRegistry = registry[chunkName];
    if (chunkRegistry) {
      // eslint-disable-next-line prefer-destructuring
      loader[keyPath] = chunkRegistry[0];
      modules.push(chunkRegistry[1]);
      optsWebpack.push(chunkRegistry[2]);
    }
  });

  return Loadable.Map({
    loading: Loading,
    loader,
    modules,
    webpack: () => optsWebpack,
    render(loaded, props) {
      // `loaded` will be a map from key path (as returned from the flattened
      // chunk names) to the modules loaded from the loaders. We now have to
      // restore the chunk names' previous shape from this flat record.
      // We do so by taking advantage of the existing `chunkNames` and replacing
      // each chunk name with its loaded module, so we don't create another
      // object from scratch.
      const loadedModules = JSON.parse(JSON.stringify(chunkNames));
      Object.entries(loaded).forEach(([keyPath, loadedModule]) => {
        // JSON modules are also loaded as `{ default: ... }` (`import()`
        // semantics) but we just want to pass the actual value to props.
        const chunk = loadedModule.default;
        // One loaded chunk can only be one of two things: a module (props) or a
        // component. Modules are always JSON, so `default` always exists. This
        // could only happen with a user-defined component.
        if (!chunk) {
          throw new Error(
            `The page component at ${path} doesn't have a default export. This makes it impossible to render anything. Consider default-exporting a React component.`,
          );
        }
        // A module can be a primitive, for example, if the user stored a string
        // as a prop. However, there seems to be a bug with swc-loader's CJS
        // logic, in that it would load a JSON module with content "foo" as
        // `{ default: "foo", 0: "f", 1: "o", 2: "o" }`. Just to be safe, we
        // first make sure that the chunk is non-primitive.
        if (typeof chunk === 'object' || typeof chunk === 'function') {
          Object.keys(loadedModule)
            .filter((k) => k !== 'default')
            .forEach((nonDefaultKey) => {
              chunk[nonDefaultKey] = loadedModule[nonDefaultKey];
            });
        }
        // We now have this chunk prepared. Go down the key path and replace the
        // chunk name with the actual chunk.
        let val = loadedModules;
        const keyPaths = keyPath.split('.');
        keyPaths.slice(0, -1).forEach((k) => {
          val = val[k];
        });
        val[keyPaths[keyPaths.length - 1]!] = chunk;
      });

      /* eslint-disable no-underscore-dangle */
      const Component = loadedModules.__comp;
      delete loadedModules.__comp;
      const routeContext = loadedModules.__context;
      delete loadedModules.__context;
      /* eslint-enable no-underscore-dangle */

      // Is there any way to put this RouteContextProvider upper in the tree?
      return (
        <RouteContextProvider value={routeContext}>
          <Component {...loadedModules} {...props} />
        </RouteContextProvider>
      );
    },
  });
}
