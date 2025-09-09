# Examples for Nornir tasks
These need to be integrated into the Nornir pipeline

## Template Usage Notes

### Common Variables Across Templates

## Template Usage Notes

### Common Variables Across Templates
| Variable | Description | Required |
|----------|-------------|----------|
| ```now()``` | Current timestamp (for audit) | No |
| ```vrf``` | VRF name for context-specific configs | No (defaults to 'default') |
| ```description``` | Human-readable description | No |

## Best Practices

### Validation: Always include basic validation in your Nornir tasks:

```
if "bgp_as" not in task.host.keys():
    return Result(host=task.host, failed=True, 
                 message="Missing required variable: bgp_as")
Idempotency: Design templates to be idempotent (re-running produces same result):
```

Use `replace:` statements in Junos instead of `set:`
For PAN-OS, use complete XML structures rather than partial updates
Testing: Validate templates with:

`python -c "from jinja2 import Environment; print(Environment().from_string(open('templates/junos/bgp.j2').read()).render(bgp_as=65001))"`
