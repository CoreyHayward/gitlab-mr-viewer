import baseConfig from './vitest.config.mjs';

const liveConfig = {
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['src/**/*.live.ts']
  }
};

export default liveConfig;
