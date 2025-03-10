/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import logger from '@docusaurus/logger';
import {getThemeName, getThemePath, getThemeNames} from './themes';
import {getThemeComponents, getComponentName} from './components';
import {helpTables, themeComponentsTable} from './tables';
import type {SwizzleAction, SwizzleComponentConfig} from '@docusaurus/types';
import type {SwizzleCLIOptions, SwizzlePlugin} from './common';
import {normalizeOptions} from './common';
import type {ActionResult} from './actions';
import {eject, getAction, wrap} from './actions';
import {getThemeSwizzleConfig} from './config';
import {askSwizzleDangerousComponent} from './prompts';
import {initSwizzleContext} from './context';

async function listAllThemeComponents({
  themeNames,
  plugins,
  typescript,
}: {
  themeNames: string[];
  plugins: SwizzlePlugin[];
  typescript: SwizzleCLIOptions['typescript'];
}) {
  const themeComponentsTables = (
    await Promise.all(
      themeNames.map(async (themeName) => {
        const themePath = getThemePath({themeName, plugins, typescript});
        const swizzleConfig = getThemeSwizzleConfig(themeName, plugins);
        const themeComponents = await getThemeComponents({
          themeName,
          themePath,
          swizzleConfig,
        });
        return themeComponentsTable(themeComponents);
      }),
    )
  ).join('\n\n');

  logger.info(`All theme components available to swizzle:

${themeComponentsTables}

${helpTables()}
    `);
  return process.exit(0);
}

async function ensureActionSafety({
  componentName,
  componentConfig,
  action,
  danger,
}: {
  componentName: string;
  componentConfig: SwizzleComponentConfig;
  action: SwizzleAction;
  danger: boolean;
}): Promise<void> {
  const actionStatus = componentConfig.actions[action];

  if (actionStatus === 'forbidden') {
    logger.error`
Swizzle action name=${action} is forbidden for component name=${componentName}
`;
    return process.exit(1);
  }

  if (actionStatus === 'unsafe' && !danger) {
    logger.warn`
Swizzle action name=${action} is unsafe to perform on name=${componentName}.
It is more likely to be affected by breaking changes in the future
If you want to swizzle it, use the code=${'--danger'} flag, or confirm that you understand the risks.
`;
    const swizzleDangerousComponent = await askSwizzleDangerousComponent();
    if (!swizzleDangerousComponent) {
      return process.exit(1);
    }
  }

  return undefined;
}

export async function swizzle(
  siteDir: string,
  themeNameParam: string | undefined,
  componentNameParam: string | undefined,
  optionsParam: Partial<SwizzleCLIOptions>,
): Promise<void> {
  const options = normalizeOptions(optionsParam);
  const {list, danger, typescript} = options;

  const {plugins} = await initSwizzleContext(siteDir);
  const themeNames = getThemeNames(plugins);

  if (list && !themeNameParam) {
    await listAllThemeComponents({themeNames, plugins, typescript});
  }

  const themeName = await getThemeName({themeNameParam, themeNames, list});
  const themePath = getThemePath({themeName, plugins, typescript});
  const swizzleConfig = getThemeSwizzleConfig(themeName, plugins);

  const themeComponents = await getThemeComponents({
    themeName,
    themePath,
    swizzleConfig,
  });

  const componentName = await getComponentName({
    componentNameParam,
    themeComponents,
    list,
  });
  const componentConfig = themeComponents.getConfig(componentName);

  const action = await getAction(componentConfig, options);

  await ensureActionSafety({componentName, componentConfig, action, danger});

  async function executeAction(): Promise<ActionResult> {
    switch (action) {
      case 'wrap': {
        const result = await wrap({
          siteDir,
          themePath,
          componentName,
          typescript,
        });
        logger.success`
Created wrapper of name=${componentName} from name=${themeName} in path=${result.createdFiles}
`;
        return result;
      }
      case 'eject': {
        const result = await eject({
          siteDir,
          themePath,
          componentName,
        });
        logger.success`
Ejected name=${componentName} from name=${themeName} to path=${result.createdFiles}
`;
        return result;
      }
      default:
        throw new Error(`Unexpected action ${action}`);
    }
  }

  await executeAction();

  return process.exit(0);
}
