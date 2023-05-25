// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

// Add any needed widget imports here (or from controls)
// import {} from '@jupyter-widgets/base';

import { createTestModel } from './utils';

import { FileUploadLiteModel } from '..';

describe('FileUploadLite', () => {
  describe('FileUploadLiteModel', () => {
    it('should be createable', () => {
      const model = createTestModel(FileUploadLiteModel);
      expect(model).toBeInstanceOf(FileUploadLiteModel);
      expect(model.get('value')).toEqual([]);
    });
  });
});
