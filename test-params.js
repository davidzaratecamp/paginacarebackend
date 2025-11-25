// Test script to verify parameter parsing
const testParams = {
    limit: '50',
    offset: undefined
};

console.log('Testing parameter parsing:');
console.log('Input:', testParams);

// Current approach
const limitParam = parseInt(String(testParams.limit || '10'), 10);
const offsetParam = parseInt(String(testParams.offset || '0'), 10);
const limit = isNaN(limitParam) ? 10 : limitParam;
const offset = isNaN(offsetParam) ? 0 : offsetParam;

console.log('Parsed limit:', limit, typeof limit);
console.log('Parsed offset:', offset, typeof offset);
console.log('Are they numbers?', typeof limit === 'number' && !isNaN(limit), typeof offset === 'number' && !isNaN(offset));
