// middleware/validateRequest.js
const { body, param, query, validationResult } = require('express-validator');
const mongoose = require('mongoose');

const validateRequest = (validationRules = {}) => {
  const validations = [];
  
  // Body validation
  if (validationRules.body) {
    Object.entries(validationRules.body).forEach(([field, rules]) => {
      let validatorChain = body(field);
      
      rules.forEach(rule => {
        if (typeof rule === 'string') {
          // Simple rules like 'required', 'email'
          switch (rule) {
            case 'required':
              validatorChain = validatorChain.notEmpty().withMessage(`${field} is required`);
              break;
            case 'email':
              validatorChain = validatorChain.isEmail().withMessage(`${field} must be a valid email`);
              break;
            case 'number':
              validatorChain = validatorChain.isNumeric().withMessage(`${field} must be a number`);
              break;
            case 'array':
              validatorChain = validatorChain.isArray().withMessage(`${field} must be an array`);
              break;
            case 'mongoId':
              validatorChain = validatorChain.isMongoId().withMessage(`${field} must be a valid MongoDB ID`);
              break;
          }
        } else if (typeof rule === 'object') {
          // Complex rules
          if (rule.min) {
            validatorChain = validatorChain.isLength({ min: rule.min })
              .withMessage(`${field} must be at least ${rule.min} characters`);
          }
          if (rule.max) {
            validatorChain = validatorChain.isLength({ max: rule.max })
              .withMessage(`${field} must be at most ${rule.max} characters`);
          }
          if (rule.in) {
            validatorChain = validatorChain.isIn(rule.in)
              .withMessage(`${field} must be one of: ${rule.in.join(', ')}`);
          }
          if (rule.custom) {
            validatorChain = validatorChain.custom(rule.custom);
          }
        }
      });
      
      validations.push(validatorChain);
    });
  }
  
  // Param validation
  if (validationRules.params) {
    Object.entries(validationRules.params).forEach(([field, rules]) => {
      let validatorChain = param(field);
      
      rules.forEach(rule => {
        if (rule === 'required') {
          validatorChain = validatorChain.notEmpty().withMessage(`${field} parameter is required`);
        }
        if (rule === 'mongoId') {
          validatorChain = validatorChain.isMongoId().withMessage(`${field} must be a valid MongoDB ID`);
        }
      });
      
      validations.push(validatorChain);
    });
  }
  
  // Query validation
  if (validationRules.query) {
    Object.entries(validationRules.query).forEach(([field, rules]) => {
      let validatorChain = query(field);
      
      rules.forEach(rule => {
        if (rule === 'optional') {
          // Optional field, no validation needed
        } else if (rule === 'number') {
          validatorChain = validatorChain.optional({ checkFalsy: true }).isNumeric()
            .withMessage(`${field} must be a number`);
        } else if (rule === 'boolean') {
          validatorChain = validatorChain.optional({ checkFalsy: true }).isBoolean()
            .withMessage(`${field} must be a boolean`);
        }
      });
      
      validations.push(validatorChain);
    });
  }
  
  // Return middleware chain
  return [
    ...validations,
    (req, res, next) => {
      const errors = validationResult(req);
      
      if (!errors.isEmpty()) {
        const formattedErrors = errors.array().map(err => ({
          field: err.path,
          message: err.msg,
          value: err.value,
          location: err.location
        }));
        
        return res.status(400).json({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          errors: formattedErrors
        });
      }
      
      next();
    }
  ];
};

module.exports = validateRequest;